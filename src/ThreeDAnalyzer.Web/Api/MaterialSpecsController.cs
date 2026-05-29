using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Api;

[ApiController]
[Route("api/material-specs")]
public class MaterialSpecsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<MaterialSpecDto>>> List()
    {
        var items = await db.MaterialSpecs.OrderBy(m => m.Specification).ToListAsync();
        return items.Select(m => m.ToDto()).ToList();
    }

    [HttpPost]
    public async Task<ActionResult<MaterialSpecDto>> Create([FromBody] CreateMaterialSpecRequest request)
    {
        var specification = (request.Specification ?? "").Trim();
        var generalName = (request.GeneralName ?? "").Trim();
        var materialType = (request.MaterialType ?? "").Trim();
        var createdBy = (request.CreatedBy ?? "").Trim();
        var status = NormalizeStatus(request.Status);

        if (string.IsNullOrEmpty(specification))
            return BadRequest("Material specification is required.");
        if (string.IsNullOrEmpty(generalName))
            return BadRequest("General name is required.");
        if (string.IsNullOrEmpty(createdBy))
            return BadRequest("Created by is required.");
        if (!DateOnly.TryParse(request.CreatedDate, out var createdDate))
            return BadRequest("Created date is invalid.");

        var density = request.Density;
        if (density < 0)
            return BadRequest("Density must be zero or greater.");

        if (await db.MaterialSpecs.AnyAsync(m => m.Specification == specification))
            return BadRequest("Material specification already exists.");

        var spec = new MaterialSpec
        {
            Specification = specification,
            GeneralName = generalName,
            MaterialType = materialType,
            Density = density,
            CreatedBy = createdBy,
            CreatedDate = createdDate,
            Status = status
        };

        db.MaterialSpecs.Add(spec);
        await db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, spec.ToDto());
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<MaterialSpecDto>> Update(int id, [FromBody] UpdateMaterialSpecRequest request)
    {
        var spec = await db.MaterialSpecs.FindAsync(id);
        if (spec == null) return NotFound();

        var generalName = (request.GeneralName ?? "").Trim();
        var materialType = (request.MaterialType ?? "").Trim();
        var createdBy = (request.CreatedBy ?? "").Trim();
        var status = NormalizeStatus(request.Status);

        if (string.IsNullOrEmpty(generalName))
            return BadRequest("General name is required.");
        if (string.IsNullOrEmpty(createdBy))
            return BadRequest("Created by is required.");
        if (!DateOnly.TryParse(request.CreatedDate, out var createdDate))
            return BadRequest("Created date is invalid.");

        var density = request.Density;
        if (density < 0)
            return BadRequest("Density must be zero or greater.");

        spec.GeneralName = generalName;
        spec.MaterialType = materialType;
        spec.Density = density;
        spec.CreatedBy = createdBy;
        spec.CreatedDate = createdDate;
        spec.Status = status;

        await db.SaveChangesAsync();
        return spec.ToDto();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var spec = await db.MaterialSpecs.FindAsync(id);
        if (spec == null) return NotFound();

        db.MaterialSpecs.Remove(spec);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static string NormalizeStatus(string? status)
    {
        var s = (status ?? "").Trim();
        if (s.Equals("inactive", StringComparison.OrdinalIgnoreCase))
            return "Inactive";
        return "Active";
    }
}
